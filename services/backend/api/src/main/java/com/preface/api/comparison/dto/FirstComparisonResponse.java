package com.preface.api.comparison.dto;

public record FirstComparisonResponse(Proposal proposal, String reason) {
    public record Proposal(
            int stateVersion, String code, double value, String description, String sourceUrl) {}
}
