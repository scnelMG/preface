import { describe, expect, it } from 'vitest'
import { PRODUCTION_HOST } from '@/shared/analytics/config'
import { isMattermostNotifyAvailable } from './mattermostAvailability'

describe('Mattermost 알림 노출 기준(-543)', () => {
  it('별도 동의로 받으므로 운영에서도 연다(-517의 운영 숨김 해제)', () => {
    expect(isMattermostNotifyAvailable(PRODUCTION_HOST)).toBe(true)
  })

  it('개발 서버(같은 호스트 8080)와 로컬에서도 보인다', () => {
    expect(isMattermostNotifyAvailable(`${PRODUCTION_HOST}:8080`)).toBe(true)
    expect(isMattermostNotifyAvailable('localhost:3000')).toBe(true)
  })
})
