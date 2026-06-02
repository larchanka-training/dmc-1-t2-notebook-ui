import { describe, expect, test } from 'vitest'
import { openCrossTabChannel, type NotebookSavedMessage } from './crosstab'

function nextMessage(): {
  promise: Promise<NotebookSavedMessage>
  resolve: (msg: NotebookSavedMessage) => void
} {
  let resolve!: (msg: NotebookSavedMessage) => void
  const promise = new Promise<NotebookSavedMessage>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('notebook cross-tab channel', () => {
  test('broadcasts saved notebook notifications to another channel instance', async () => {
    const received = nextMessage()
    const sender = openCrossTabChannel(() => {})
    const receiver = openCrossTabChannel(received.resolve)

    try {
      sender.postSaved('notebook-1', 123)
      await expect(received.promise).resolves.toEqual({
        type: 'saved',
        id: 'notebook-1',
        updatedAt: 123,
      })
    } finally {
      sender.close()
      receiver.close()
    }
  })
})
