const getRateLimit = require('../index')
const Promise = require('bluebird')
const Redis = require('ioredis')
const redis = new Redis()
const assert = require('assert')
const request = require('supertest')
const express = require('express')

const redisKey = 'test:someKey'

const app = express()
const windowMs = 1000

const rateLimit1 = getRateLimit({
  redisClient: redis,
  keyGenerator: req => redisKey,
  windowMs: 1000,
  max: 1
})

app.get('/', rateLimit1, function (req, res) {
  res.end()
})

function clearRedis(done) {
  redis.del(redisKey, err => {
    if (err) {
      throw err
    }
    done()
  })
}

describe('Basic block', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request(app)
      .get('/')
      .expect(200, done)
  })

  it('2nd request blocked', function (done) {
    request(app)
      .get('/')
      .expect(429, done)
  })
})

describe('Wait expire', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request(app)
      .get('/')
      .expect(200, done)
  })

  it('2nd request blocked', function (done) {
    request(app)
      .get('/')
      .expect(429, done)
  })

  it('3rd request pass after expiration', function (done) {
    setTimeout(() => {
      request(app)
        .get('/')
        .expect(200, done)
    }, windowMs)
  })
})

const rateLimit2 = getRateLimit({
  redisClient: redis,
  keyGenerator: req => redisKey,
  onLimitReached: (req, res, next, redisKey, redisValue) => {
    assert(redisKey === 'test:someKey')
    assert(redisValue === 2)
    res.status(401).json({code: 1})
  },
  skip: req => {
    if(req.query.skip){
      return Promise.resolve(true)
    }
    else{
      return Promise.resolve(false)
    }
  },
  windowMs: 1000,
  max: 1
})

app.get('/2', rateLimit2, function (req, res) {
  res.end()
})

describe('Custom response on limit', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request(app)
      .get('/2')
      .expect(200, done)
  })

  it('2nd request blocked and get custom response', function (done) {
    request(app)
      .get('/2')
      .expect(401, {code: 1}, done)
  })

  it('3rd request should skip', function (done) {
    request(app)
      .get('/2?skip=true')
      .expect(200, done)
  })
})

const rateLimit3 = getRateLimit({
  redisClient: redis,
  keyGenerator: req => redisKey,
  windowMs: 100,
  max: 2
})

app.get('/3', rateLimit3, function (req, res) {
  res.end()
})

describe('Allow 2 request in 100ms', function () {
  before('clear redis', clearRedis)

  it('1st request pass through', function (done) {
    request(app)
      .get('/3')
      .expect(200, done)
  })

  it('2nd request pass through', function (done) {
    request(app)
      .get('/3')
      .expect(200, done)
  })

  it('3rd request blocked', function (done) {
    request(app)
      .get('/3')
      .expect(429, done)
  })

  it('4th request pass after expiration', function (done) {
    setTimeout(() => {
      request(app)
        .get('/3')
        .expect(200, done)
    }, 100)
  })
})

