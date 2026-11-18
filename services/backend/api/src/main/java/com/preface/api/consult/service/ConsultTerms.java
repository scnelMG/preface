package com.preface.api.consult.service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 검수 카드의 코 용어 설명만 찾는다. 검색 결과는 편집 권한이 아니다. */
final class ConsultTerms {
    private static final Map<String, String> SOURCES =
            Map.of(
                    "N-3D", "https://pubmed.ncbi.nlm.nih.gov/24524953/",
                    "N-REVIEW", "https://pmc.ncbi.nlm.nih.gov/articles/PMC7159929/",
                    "N-ANATOMY", "https://pmc.ncbi.nlm.nih.gov/articles/PMC2526105/",
                    "N-ANGLE", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4956864/");
    private static final Pattern COMPARISON =
            Pattern.compile(
                    "(?:같은|다른)(?:건|것|말|뜻|부위|부분)(?:인지|인가요|인가|가요|가|일까|이야|야|이에요|예요|요|니|까|$)"
                            + "|차이(?:가|는|를)?(?:뭐|어떻|있|알려|설명|$)"
                            + "|구분(?:해|되|$)|다르(?:니|나요|지)|다른가요|달라(?:요|$)");

    private final List<Card> cards;

    ConsultTerms(ObjectMapper mapper) {
        try (var input = ConsultTerms.class.getResourceAsStream("/consult-terms-v1.json")) {
            if (input == null) throw new IllegalStateException("consult term cards missing");
            List<Card> loaded = new ArrayList<>();
            for (JsonNode row : mapper.readTree(input)) {
                if (!row.path("id").asText().startsWith("N")) continue;
                List<String> aliases = new ArrayList<>();
                row.path("aliases").forEach(alias -> aliases.add(normalize(alias.asText())));
                loaded.add(
                        new Card(
                                row.path("id").asText(),
                                row.path("term").asText(),
                                row.path("meaning").asText(),
                                aliases,
                                SOURCES.get(row.path("sourceIds").get(0).asText()),
                                row.path("candidateCodes")
                                        .valueStream()
                                        .map(JsonNode::asText)
                                        .toList()));
            }
            if (loaded.size() != 8 || loaded.stream().anyMatch(card -> card.source() == null)) {
                throw new IllegalStateException("invalid consult term cards");
            }
            cards = List.copyOf(loaded);
        } catch (IOException e) {
            throw new IllegalStateException("consult term cards unreadable", e);
        }
    }

    Map<String, String> evidence(List<String> supportedCodes) {
        return cards.stream()
                .filter(card -> card.codes().stream().anyMatch(supportedCodes::contains))
                .collect(java.util.stream.Collectors.toUnmodifiableMap(Card::id, Card::meaning));
    }

    String evidenceFor(String id, String code) {
        return cards.stream()
                .filter(card -> card.id().equals(id) && card.codes().contains(code))
                .findFirst()
                .map(card -> card.meaning() + " 출처: " + card.source())
                .orElse("");
    }

    String explain(String question) {
        List<Card> matches = matches(question);
        if (matches.isEmpty()) return null;
        if (matches.size() == 2 && isComparisonQuestion(question)) {
            Card first = matches.get(0);
            Card second = matches.get(1);
            return "같은 말이 아니에요. "
                    + comparisonMeaning(first)
                    + " "
                    + comparisonMeaning(second)
                    + " 출처: "
                    + first.source()
                    + (first.source().equals(second.source()) ? "" : ", " + second.source());
        }
        if (matches.size() != 1) return "어느 코 부위를 뜻하시는지 다시 말씀해 주세요.";
        Card card = matches.getFirst();
        return card.meaning() + " 출처: " + card.source();
    }

    private static String comparisonMeaning(Card card) {
        return card.meaning().startsWith(card.term().split("[ ·]")[0])
                ? card.meaning()
                : card.term() + ": " + card.meaning();
    }

    boolean isComparisonQuestion(String question) {
        return COMPARISON.matcher(normalize(question)).find();
    }

    boolean explanationOnly(String question) {
        List<Card> matches = matches(question);
        return !matches.isEmpty() && matches.stream().allMatch(Card::explanationOnly);
    }

    private List<Card> matches(String question) {
        String text = normalize(question);
        // 비주는 각도를 이루는 기준 부위일 뿐, 입술과의 각도를 묻는 질문의 답은 비순각이다.
        if (text.contains("입술")
                && text.contains("각도")
                && (text.contains("비주") || text.contains("코기둥") || text.contains("콧구멍사이"))
                && !isComparisonQuestion(question)) {
            return cards.stream().filter(card -> card.term().equals("비순각")).toList();
        }
        List<Hit> hits = new ArrayList<>();
        for (Card card : cards) {
            for (String alias : card.aliases()) {
                for (int start = text.indexOf(alias);
                        start >= 0;
                        start = text.indexOf(alias, start + 1)) {
                    if (isSpatialReference(text, alias, start + alias.length())) continue;
                    hits.add(new Hit(card, start, start + alias.length()));
                }
            }
        }
        return hits.stream()
                .filter(
                        hit ->
                                hits.stream()
                                        .noneMatch(
                                                other ->
                                                        other.card() != hit.card()
                                                                && other.covers(hit)))
                .map(Hit::card)
                .distinct()
                .toList();
    }

    private static String normalize(String text) {
        return text.toLowerCase()
                .replaceAll("[^0-9a-z가-힣]", "")
                .replace("콧끝", "코끝")
                .replace("밑", "아래")
                .replace("세로", "수직")
                .replace("사이의", "사이");
    }

    private static boolean isSpatialReference(String text, String alias, int end) {
        // 위치 설명의 기준점은 질문 대상 자체가 아니다.
        String rest = text.substring(end);
        if (alias.equals("콧구멍")) return rest.startsWith("옆") || rest.startsWith("밖");
        return alias.equals("코끝")
                && (rest.startsWith("아래") || rest.startsWith("밑"))
                && (rest.contains("살") || rest.contains("기둥"));
    }

    private record Card(
            String id,
            String term,
            String meaning,
            List<String> aliases,
            String source,
            List<String> codes) {
        boolean explanationOnly() {
            return codes.isEmpty();
        }
    }

    private record Hit(Card card, int start, int end) {
        boolean covers(Hit other) {
            return start <= other.start
                    && end >= other.end
                    && end - start > other.end - other.start;
        }
    }
}
