import test from 'node:test'
import assert from 'node:assert/strict'
import { enableRuleFallthrough } from '../apps/lib/fallthrough.js'

async function dispatch(plugins, event) {
  for (const instance of plugins) {
    for (const rule of instance.rule || []) {
      if (!new RegExp(rule.reg).test(event.msg)) continue
      const result = await instance[rule.fnc](event)
      if (result !== false) return instance
    }
  }
  return null
}

function makePlugin(name, rule, handlers) {
  return enableRuleFallthrough({ name, rule, ...handlers })
}

test('a handled command yields to the next plugin', async () => {
  const calls = []
  const first = makePlugin('first', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { calls.push('first'); return true },
  })
  const second = makePlugin('second', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { calls.push('second'); return true },
  })

  await dispatch([first, second], { msg: '#item' })
  assert.deepEqual(calls, ['first', 'second'])
})

test('undefined return yields downstream without rerunning overlapping rules', async () => {
  let firstCalls = 0
  let secondCalls = 0
  const first = makePlugin('first', [
    { reg: '^#item$', fnc: 'handle' },
    { reg: '^#item$', fnc: 'handle' },
  ], {
    async handle() { firstCalls++ },
  })
  const second = makePlugin('second', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { secondCalls++; return true },
  })

  await dispatch([first, second], { msg: '#item' })
  assert.equal(firstCalls, 1)
  assert.equal(secondCalls, 1)
})

test('a non-match yields without marking the event handled', async () => {
  const calls = []
  const first = makePlugin('first', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { calls.push('first'); return false },
  })
  const second = makePlugin('second', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { calls.push('second'); return true },
  })

  await dispatch([first, second], { msg: '#item' })
  assert.deepEqual(calls, ['first', 'second'])
})

test('overlapping rules do not execute the same plugin twice after a handled result', async () => {
  let firstCalls = 0
  let secondCalls = 0
  const first = makePlugin('first', [
    { reg: '^#item$', fnc: 'handle' },
    { reg: '^#item$', fnc: 'handle' },
  ], {
    async handle() { firstCalls++; return true },
  })
  const second = makePlugin('second', [{ reg: '^#item$', fnc: 'handle' }], {
    async handle() { secondCalls++; return true },
  })

  await dispatch([first, second], { msg: '#item' })
  assert.equal(firstCalls, 1)
  assert.equal(secondCalls, 1)
})

test('nested rewritten commands restore the original message and remain handled', async () => {
  let nestedCalls = 0
  let overlappingCalls = 0
  const first = makePlugin('first', [
    { reg: '^alias$', fnc: 'rewrite' },
    { reg: '^#exact$', fnc: 'exact' },
    { reg: '^.*$', fnc: 'overlap' },
  ], {
    async rewrite(event) {
      event.msg = '#exact'
      return this.exact(event)
    },
    async exact(event) {
      nestedCalls++
      assert.equal(event.msg, '#exact')
      return true
    },
    async overlap() { overlappingCalls++; return true },
  })
  const second = makePlugin('second', [{ reg: '^alias$', fnc: 'handle' }], {
    async handle(event) { assert.equal(event.msg, 'alias'); return true },
  })
  const event = { msg: 'alias' }

  await dispatch([first, second], event)
  assert.equal(event.msg, 'alias')
  assert.equal(nestedCalls, 1)
  assert.equal(overlappingCalls, 0)
})

test('handler errors are logged and yielded to the next plugin', async () => {
  const logs = []
  const previousLogger = globalThis.logger
  globalThis.logger = { error: (...args) => logs.push(args) }
  try {
    const calls = []
    const first = makePlugin('first', [{ reg: '^#item$', fnc: 'throws' }], {
      async throws() { calls.push('throws'); throw new Error('test error') },
    })
    const second = makePlugin('second', [{ reg: '^#item$', fnc: 'handle' }], {
      async handle() { calls.push('second'); return true },
    })

    await dispatch([first, second], { msg: '#item' })
    assert.deepEqual(calls, ['throws', 'second'])
    assert.equal(logs.length, 1)
    assert.equal(logs[0][1].message, 'test error')
  } finally {
    if (previousLogger === undefined) delete globalThis.logger
    else globalThis.logger = previousLogger
  }
})
