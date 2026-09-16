import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, renderHook } from '@testing-library/react'

import { useGameTimer } from './useGameTimer'

beforeEach(() => jest.useFakeTimers())
afterEach(() => { cleanup(); jest.useRealTimers() })

function start() {
  const onTimeUp = jest.fn()
  const hook = renderHook(() => useGameTimer({ onTimeUp }))
  act(() => hook.result.current.startCountdown())
  expect(hook.result.current.countdownValue).toBe(3)
  act(() => jest.advanceTimersByTime(3000))
  expect(hook.result.current.timerState).toBe('running')
  expect(hook.result.current.timeLeft).toBe(60)
  return { ...hook, onTimeUp }
}

describe('preserved game timer', () => {
  it('counts down for three seconds and supports five ten-second streak bonuses', () => {
    const { result } = start()
    act(() => {
      for (let streak = 1; streak <= 5; streak++) result.current.addBonusTime(streak)
    })
    expect(result.current.timeLeft).toBe(110)
    expect(result.current.maxTime).toBe(110)
    act(() => result.current.addBonusTime(6))
    expect(result.current.timeLeft).toBe(110)
  })

  it('deducts a quarter second and pauses for five seconds, with manual resume', () => {
    const { result } = start()
    act(() => {
      result.current.deductTime(0.25)
      result.current.pauseTimer(5)
    })
    expect(result.current.timeLeft).toBe(59.75)
    expect(result.current.timerState).toBe('paused')
    act(() => jest.advanceTimersByTime(4000))
    expect(result.current.timeLeft).toBe(59.75)
    act(() => result.current.resumeTimer())
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.timeLeft).toBe(58.75)
    expect(result.current.timerState).toBe('running')
  })

  it('automatically resumes after the five-second wrong-answer pause', () => {
    const { result } = start()
    act(() => result.current.pauseTimer(5))
    act(() => jest.advanceTimersByTime(5000))
    expect(result.current.timerState).toBe('running')
    expect(result.current.timeLeft).toBe(60)
  })

  it('allows the answer handler to queue its final answer before reporting penalty expiry', () => {
    const { result, onTimeUp } = start()
    act(() => result.current.deductTime(59.75))
    act(() => {
      expect(result.current.deductTime(0.25)).toBe(true)
      expect(onTimeUp).not.toHaveBeenCalled()
    })
    expect(result.current.timeLeft).toBe(0)
    expect(result.current.timerState).toBe('ended')
    expect(onTimeUp).toHaveBeenCalledTimes(1)
  })

  it('does not restart a one-second tick when its caller rerenders', () => {
    const hook = renderHook(() => useGameTimer({ onTimeUp: () => {} }))
    act(() => hook.result.current.startCountdown())
    act(() => jest.advanceTimersByTime(3000))
    act(() => jest.advanceTimersByTime(700))
    hook.rerender()
    act(() => jest.advanceTimersByTime(300))
    expect(hook.result.current.timeLeft).toBe(59)
  })

  it('cleans up countdown callbacks when the previous game unmounts', () => {
    const complete = jest.fn()
    const hook = renderHook(() => useGameTimer({ onCountdownComplete: complete }))
    act(() => hook.result.current.startCountdown())
    hook.unmount()
    act(() => jest.advanceTimersByTime(3000))
    expect(complete).not.toHaveBeenCalled()
  })
})
