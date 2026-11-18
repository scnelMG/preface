package com.preface.api.reconstruction.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** INT-REC-02 응답. {@code continue=false}면 워커가 즉시 멈춘다. */
public record ProgressResponse(@JsonProperty("continue") boolean proceed) {}
