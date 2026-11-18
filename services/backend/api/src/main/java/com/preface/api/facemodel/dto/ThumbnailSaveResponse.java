package com.preface.api.facemodel.dto;

/** 저장된 썸네일 presigned GET(10분). 이미 다른 썸네일이 먼저 저장됐으면 그 주소다. */
public record ThumbnailSaveResponse(String faceModelId, String thumbnailUrl) {

    @Override
    public String toString() {
        return "ThumbnailSaveResponse[faceModelId=" + faceModelId + ", thumbnailUrl=<redacted>]";
    }
}
