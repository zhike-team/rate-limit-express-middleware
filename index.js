'use strict';

module.exports = (options) => {
  if (!(options instanceof Object)) {
    throw new Error('options must be an Object');
  }

  const redis = options.redisClient;
  if (typeof redis !== 'object') {
    throw new Error('options.redisClient must be an instance of redis(https://www.npmjs.com/package/redis) or ioredis(https://www.npmjs.com/package/ioredis)');
  }

  const windowMs = options.windowMs;
  if (!(Number.isInteger(windowMs) && windowMs > 0)) {
    throw new Error('options.windowMs must be an integer larger than zero');
  }

  const max = options.max;
  if (!(Number.isInteger(max) && max > 0)) {
    throw new Error('options.max must be an integer larger than zero');
  }

  let keyFn = req => {
    // default key is IP address
    let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress;
    let matchResult = ip.match(/\d+\.\d+\.\d+\.\d+/);
    if (matchResult) {
      ip = matchResult[0];
    }
    else {
      ip = '0.0.0.0';
    }
    return 'rate-limit-middleware:' + ip;
  }
  if (options.keyGenerator) {
    if (typeof options.keyGenerator === 'function') {
      keyFn = options.keyGenerator;
    }
    else {
      throw new Error('options.keyGenerator must be a function which returns a string as redis key');
    }
  }

  let onLimitReached = (req, res, next, redisKey, redisValue) => {
    // default behavior when reach limit
    let err = new Error('Too many requests');
    err.status = 429;
    next(err);
  }
  if (options.onLimitReached) {
    if (typeof options.onLimitReached === 'function') {
      onLimitReached = options.onLimitReached;
    }
    else {
      throw new Error('options.onLimitReached must be a function which handles response when rate limit is reached');
    }
  }

  let onError = (err, req, res, next) => {
    // default behavior: throw exception
    next(err);
  }

  if (options.onError) {
    if (typeof options.onError === 'function') {
      onError = options.onError;
    }
    else {
      throw new Error('options.onError must be a function which handles response when cannot access redis');
    }
  }

  let skip = req => Promise.resolve(); // not skip by default
  if (options.skip) {
    if (typeof options.skip === 'function') {
      skip = options.skip;
    }
    else {
      throw new Error('options.skip must be a function which return a Promise');
    }
  }

  const judge = (req, res, next) => {
    let redisKey = keyFn(req);
    const lua = `
          local current
          current = tonumber(redis.call("incr", KEYS[1]))
          if current == 1 then
            redis.call("pexpire", KEYS[1], ARGV[1])
          end
          return current`;

    redis.eval(lua, 1, redisKey, windowMs, (err, result) => {
      if (err) {
        return onError(err, req, res, next);
      }
      if (result > max) {
        onLimitReached(req, res, next, redisKey, result);
      }
      else {
        next();
      }
    });
  }

  return (req, res, next) => {
    skip(req)
      .then((shouldSkip) => {
        if (shouldSkip) {
          next();
        }
        else {
          judge(req, res, next);
        }
        return null; // to avoid Promise warning
      })
      .catch(() => {
        judge(req, res, next); // not skip if error
      });
  }
}
