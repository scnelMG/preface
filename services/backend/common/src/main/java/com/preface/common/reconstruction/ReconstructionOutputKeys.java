package com.preface.common.reconstruction;

import com.preface.common.facemodel.entity.CaptureAngle;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;

/** 복원 출력은 GPU 시도별 경로를 쓴다. 이전 워커의 늦은 PUT이 새 시도 결과를 덮어쓰지 못한다. */
public final class ReconstructionOutputKeys {

    /** 표정 트래킹 리그 파일 이름(S15P31B204-879). 결과 업로드 URL 발급·결과 검사·기존 모델 보충이 같은 이름을 쓴다. */
    public static final String EXPRESSION_FILE = "expression.json";

    private ReconstructionOutputKeys() {}

    /**
     * 이 메시에 맞는 표정 리그 key: 메시와 같은 폴더의 {@link #EXPRESSION_FILE}. 표정 리그는 그 메시의 정점으로 만들므로 다른 폴더의 리그는 다른
     * 메시용이다. 기존 모델 보충 요청 검사와 모델 상세 주소가 같이 쓴다.
     */
    public static String expressionBeside(String meshObjectKey) {
        return meshObjectKey.substring(0, meshObjectKey.lastIndexOf('/') + 1) + EXPRESSION_FILE;
    }

    public static String prefix(String userId, String jobId, int attempt) {
        return "users/" + userId + "/models/" + jobId + "/a" + attempt + "/";
    }

    /**
     * 추출 시도별 프레임 묶음 key(contracts/frame-extraction). api의 묶음 발급·삭제와 job-manager의 추출 시간 초과 정리가 같은
     * key를 쓴다(S15P31B204-593).
     */
    public static String framesBundle(String userId, String uploadId, int attempt) {
        return "users/" + userId + "/uploads/" + uploadId + "/frames-a" + attempt + ".tar";
    }

    public static List<String> all(String userId, String jobId, int attempt) {
        String prefix = prefix(userId, jobId, attempt);
        return Stream.concat(
                        Stream.of(
                                "mesh.glb",
                                "rig.json",
                                EXPRESSION_FILE,
                                "texture.png",
                                "thumbnail.webp"),
                        Arrays.stream(CaptureAngle.values()).map(CaptureAngle::fileName))
                .map(name -> prefix + name)
                .toList();
    }
}
