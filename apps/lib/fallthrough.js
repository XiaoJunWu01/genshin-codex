/**
 * Let a handled command yield to later plugins without re-running this plugin's
 * overlapping rules against the same event. Rule handlers must return false
 * when they did not handle the event; any other return value counts as handled.
 */
export function enableRuleFallthrough(instance) {
  const stoppedEvents = new WeakSet()
  const handledDuringEvent = new WeakSet()
  const activeDepth = new WeakMap()
  const handlers = new Set((instance.rule || []).map(rule => rule?.fnc).filter(Boolean))

  for (const name of handlers) {
    const handler = instance[name]
    if (typeof handler !== 'function') continue

    instance[name] = async function (e, ...args) {
      const validEvent = e && (typeof e === 'object' || typeof e === 'function')
      if (validEvent && (stoppedEvents.has(e) || (activeDepth.has(e) && handledDuringEvent.has(e)))) return false
      const originalMessage = validEvent ? e.msg : undefined
      const depth = validEvent ? (activeDepth.get(e) || 0) : 0
      if (validEvent) activeDepth.set(e, depth + 1)
      let succeeded = false

      try {
        const result = await handler.call(this, e, ...args)
        succeeded = result !== false
      } catch (error) {
        globalThis.logger?.error?.(`[${this.name || '插件'}][${name}]`, error)
      } finally {
        if (validEvent) {
          const nextDepth = Math.max(0, (activeDepth.get(e) || 1) - 1)
          if (succeeded) handledDuringEvent.add(e)
          if (nextDepth === 0) {
            activeDepth.delete(e)
            if (handledDuringEvent.has(e)) stoppedEvents.add(e)
            handledDuringEvent.delete(e)
            if (e.msg !== originalMessage) e.msg = originalMessage
          } else {
            activeDepth.set(e, nextDepth)
          }
        }
      }
      return false
    }
  }

  return instance
}
