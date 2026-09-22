#!lua name=agentmeter_v1

local function number_field(key, field, default)
  local value = redis.call('HGET', key, field)
  if not value then
    return default
  end
  return tonumber(value)
end

local function now_ms()
  local value = redis.call('TIME')
  return (tonumber(value[1]) * 1000) + math.floor(tonumber(value[2]) / 1000)
end

local function encode_idempotency(run_id, decision, status, reason)
  return run_id .. '|' .. decision .. '|' .. status .. '|' .. reason
end

local function decode_idempotency(value)
  local run_id, decision, status, reason = string.match(value, '^([^|]*)|([^|]*)|([^|]*)|(.*)$')
  return {run_id, decision, status, reason}
end

redis.register_function('agentmeter_initialize_budget', function(keys, args)
  local budget_key = keys[1]
  redis.call('HSET', budget_key,
    'limit', args[1],
    'spent', args[2],
    'reserved', args[3],
    'active', args[4],
    'concurrency', args[5],
    'generation', args[6],
    'admissions_open', args[7],
    'overage', args[8] or '0')
  return {'OK'}
end)

redis.register_function('agentmeter_reserve_run', function(keys, args)
  local budget_key = keys[1]
  local run_key = keys[2]
  local idem_key = keys[3]
  local leases_key = keys[4]
  local run_id = args[1]
  local amount = tonumber(args[2])
  local lease_ttl_ms = tonumber(args[3])
  local idem_ttl_ms = tonumber(args[4])
  local owner = args[5]

  local existing = redis.call('GET', idem_key)
  if existing then
    local parts = decode_idempotency(existing)
    local current_status = parts[3]
    if redis.call('EXISTS', run_key) == 1 then
      current_status = redis.call('HGET', run_key, 'status') or current_status
    end
    return {parts[2], parts[1], '0', current_status, parts[4]}
  end

  if redis.call('EXISTS', budget_key) == 0 or redis.call('HGET', budget_key, 'admissions_open') ~= '1' then
    local value = encode_idempotency(run_id, 'REJECTED', 'REJECTED', 'PROJECTION_UNAVAILABLE')
    redis.call('SET', idem_key, value, 'PX', idem_ttl_ms)
    return {'REJECTED', run_id, '1', 'REJECTED', 'PROJECTION_UNAVAILABLE'}
  end

  local limit = number_field(budget_key, 'limit', 0)
  local spent = number_field(budget_key, 'spent', 0)
  local reserved = number_field(budget_key, 'reserved', 0)
  local active = number_field(budget_key, 'active', 0)
  local concurrency = number_field(budget_key, 'concurrency', 0)

  if active >= concurrency then
    local value = encode_idempotency(run_id, 'REJECTED', 'REJECTED', 'CONCURRENCY_EXHAUSTED')
    redis.call('SET', idem_key, value, 'PX', idem_ttl_ms)
    return {'REJECTED', run_id, '1', 'REJECTED', 'CONCURRENCY_EXHAUSTED'}
  end

  if amount < 0 or (spent + reserved + amount) > limit then
    local value = encode_idempotency(run_id, 'REJECTED', 'REJECTED', 'BUDGET_EXHAUSTED')
    redis.call('SET', idem_key, value, 'PX', idem_ttl_ms)
    return {'REJECTED', run_id, '1', 'REJECTED', 'BUDGET_EXHAUSTED'}
  end

  local expires_at = now_ms() + lease_ttl_ms
  redis.call('HINCRBY', budget_key, 'reserved', amount)
  redis.call('HINCRBY', budget_key, 'active', 1)
  redis.call('HSET', run_key,
    'run_id', run_id,
    'budget_period_id', args[6],
    'amount', tostring(amount),
    'status', 'RESERVED',
    'owner', owner,
    'fence', '1',
    'lease_expires_at', tostring(expires_at),
    'settlement_id', '')
  redis.call('ZADD', leases_key, expires_at, run_id)
  redis.call('SET', idem_key, encode_idempotency(run_id, 'ACCEPTED', 'RESERVED', ''), 'PX', idem_ttl_ms)
  return {'ACCEPTED', run_id, '1', 'RESERVED', '', '1', tostring(expires_at)}
end)

redis.register_function('agentmeter_restore_run', function(keys, args)
  local run_key = keys[1]
  local idem_key = keys[2]
  local leases_key = keys[3]
  local run_id = args[1]
  local amount = args[2]
  local status = args[3]
  local owner = args[4]
  local fence = args[5]
  local expires_at = tonumber(args[6])
  local budget_period_id = args[7]
  local idem_ttl_ms = tonumber(args[8])

  redis.call('HSET', run_key,
    'run_id', run_id,
    'budget_period_id', budget_period_id,
    'amount', amount,
    'status', status,
    'owner', owner,
    'fence', fence,
    'lease_expires_at', tostring(expires_at),
    'settlement_id', '')
  redis.call('SET', idem_key, encode_idempotency(run_id, 'ACCEPTED', status, ''), 'PX', idem_ttl_ms)
  if status == 'RESERVED' or status == 'RUNNING' then
    redis.call('ZADD', leases_key, expires_at, run_id)
  else
    redis.call('ZREM', leases_key, run_id)
  end
  return {'RESTORED'}
end)

redis.register_function('agentmeter_mark_running', function(keys, args)
  local run_key = keys[1]
  local leases_key = keys[2]
  local owner = args[1]
  local lease_ttl_ms = tonumber(args[2])
  local status = redis.call('HGET', run_key, 'status')
  if status == 'RUNNING' then
    return {'ALREADY_RUNNING', redis.call('HGET', run_key, 'fence') or '0'}
  end
  if status ~= 'RESERVED' then
    return {'INVALID_STATE', status or 'MISSING'}
  end
  if redis.call('HGET', run_key, 'owner') ~= owner then
    return {'OWNER_MISMATCH'}
  end
  local expires_at = now_ms() + lease_ttl_ms
  redis.call('HSET', run_key, 'status', 'RUNNING', 'lease_expires_at', tostring(expires_at))
  redis.call('ZADD', leases_key, expires_at, redis.call('HGET', run_key, 'run_id'))
  return {'RUNNING', redis.call('HGET', run_key, 'fence'), tostring(expires_at)}
end)

redis.register_function('agentmeter_renew_lease', function(keys, args)
  local run_key = keys[1]
  local leases_key = keys[2]
  local owner = args[1]
  local fence = args[2]
  local lease_ttl_ms = tonumber(args[3])
  if redis.call('HGET', run_key, 'status') ~= 'RUNNING' then
    return {'INVALID_STATE'}
  end
  if redis.call('HGET', run_key, 'owner') ~= owner or redis.call('HGET', run_key, 'fence') ~= fence then
    return {'FENCE_REJECTED'}
  end
  local expires_at = now_ms() + lease_ttl_ms
  redis.call('HSET', run_key, 'lease_expires_at', tostring(expires_at))
  redis.call('ZADD', leases_key, expires_at, redis.call('HGET', run_key, 'run_id'))
  return {'RENEWED', tostring(expires_at)}
end)

redis.register_function('agentmeter_cancel_reservation', function(keys, args)
  local budget_key = keys[1]
  local run_key = keys[2]
  local leases_key = keys[3]
  local reason = args[1]
  local status = redis.call('HGET', run_key, 'status')
  if status == 'CANCELLED' then
    return {'ALREADY_CANCELLED'}
  end
  if status == 'SETTLED' then
    return {'ALREADY_SETTLED'}
  end
  if status == 'RUNNING' or status == 'RECONCILING' then
    return {'RUN_ALREADY_STARTED'}
  end
  if not status then
    return {'MISSING'}
  end
  local amount = number_field(run_key, 'amount', 0)
  redis.call('HINCRBY', budget_key, 'reserved', -amount)
  redis.call('HINCRBY', budget_key, 'active', -1)
  redis.call('HSET', run_key, 'status', 'CANCELLED', 'cancel_reason', reason, 'lease_expires_at', '0')
  redis.call('ZREM', leases_key, redis.call('HGET', run_key, 'run_id'))
  return {'CANCELLED'}
end)

redis.register_function('agentmeter_hold_for_reconciliation', function(keys, args)
  local run_key = keys[1]
  local leases_key = keys[2]
  local reason = args[1]
  local status = redis.call('HGET', run_key, 'status')
  if status == 'SETTLED' then
    return {'ALREADY_SETTLED'}
  end
  if not status then
    return {'MISSING'}
  end
  redis.call('HSET', run_key, 'status', 'RECONCILING', 'reconcile_reason', reason, 'lease_expires_at', '0')
  redis.call('ZREM', leases_key, redis.call('HGET', run_key, 'run_id'))
  return {'RECONCILING'}
end)

redis.register_function('agentmeter_settle_run', function(keys, args)
  local budget_key = keys[1]
  local run_key = keys[2]
  local leases_key = keys[3]
  local settlement_id = args[1]
  local actual = tonumber(args[2])
  local existing = redis.call('HGET', run_key, 'settlement_id')
  if existing and existing ~= '' then
    if existing == settlement_id then
      return {'ALREADY_APPLIED'}
    end
    return {'SETTLEMENT_CONFLICT'}
  end
  local status = redis.call('HGET', run_key, 'status')
  if not status then
    return {'MISSING'}
  end
  if status == 'CANCELLED' then
    return {'INVALID_STATE', status}
  end
  local amount = number_field(run_key, 'amount', 0)
  redis.call('HINCRBY', budget_key, 'reserved', -amount)
  redis.call('HINCRBY', budget_key, 'spent', actual)
  redis.call('HINCRBY', budget_key, 'active', -1)
  redis.call('HSET', run_key,
    'status', 'SETTLED',
    'actual', tostring(actual),
    'settlement_id', settlement_id,
    'lease_expires_at', '0')
  redis.call('ZREM', leases_key, redis.call('HGET', run_key, 'run_id'))
  if actual > amount then
    redis.call('HINCRBY', budget_key, 'overage', actual - amount)
    redis.call('HSET', budget_key, 'admissions_open', '0')
  end
  return {'SETTLED', tostring(amount - math.min(amount, actual))}
end)
