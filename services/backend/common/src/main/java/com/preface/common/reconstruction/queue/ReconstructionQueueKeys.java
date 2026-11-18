package com.preface.common.reconstruction.queue;

import java.time.Duration;

/**
 * 복원 대기열 Redis key·hash 필드 이름. api(claim·진행 보고)와 job-manager(lease 회수)가 같은 값을 써야 해서 여기 한 곳에 둔다.
 *
 * <pre>
 * recon:jobs          list  대기. LPUSH로 넣고 오른쪽에서 꺼낸다
 * recon:processing    list  워커에 넘겨준 작업. 결과 보고가 커밋된 뒤에 지운다
 * recon:claim:{jobId} hash  workerId, claimedAt, lastSeenAt(epoch ms), attempts
 * </pre>
 *
 * <p>계약: {@code contracts/reconstruction/README.md} "Spring 안의 큐".
 */
public final class ReconstructionQueueKeys {

    public static final String JOBS = "recon:jobs";
    public static final String PROCESSING = "recon:processing";
    public static final String CLAIM_PREFIX = "recon:claim:";

    public static final String WORKER_ID = "workerId";
    public static final String CLAIMED_AT = "claimedAt";
    public static final String LAST_SEEN_AT = "lastSeenAt";
    public static final String ATTEMPTS = "attempts";

    /** claim 메타 hash의 TTL. lease(600초)보다 충분히 길게 둬 회수 전에 사라지지 않게 한다. */
    public static final Duration CLAIM_TTL = Duration.ofDays(2);

    private ReconstructionQueueKeys() {}

    public static String claim(String jobId) {
        return CLAIM_PREFIX + jobId;
    }
}
