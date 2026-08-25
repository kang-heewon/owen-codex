# Compact Examples

Examples illustrate decisions, not mandatory phrasing.

## Ordinary Prose

Before: “Here is a comprehensive overview of the issue. It is important to note that the cache is stale.”

Polish: “The cache is stale.”

The framing contributes no orientation. If the overview scope mattered, retain it.

## Message or Email

Before: “궁극적으로, 해당 일정에 대한 조정을 진행할 수 있도록 하겠습니다.”

Polish: “일정을 조정하겠습니다.”

The shorter version fits a direct team message. A formal external commitment may require the original register.

## README

Before: “This powerful and flexible mechanism allows users to leverage configuration in order to achieve customization.”

Polish: “Set the configuration keys below to customize the client.”

The edit supplies a concrete action already supported by the surrounding README; it does not invent a capability.

## Technical Explanation

Before: “The gateway may skip caching when `entity_id` is present because it cannot invalidate that entity independently.”

Wrong simplification: “The gateway skips caching for reliability.”

Conservative polish: “The gateway may skip caching when `entity_id` is present because the cache cannot invalidate that entity independently.”

Keep `may`, the condition, identifier, and mechanism.

## 한국어 도메인 문맥

소프트웨어 원문: “핸들러가 이벤트를 소비한 뒤 변경을 전파한다.”

일반 애플리케이션 설명: “핸들러가 이벤트를 처리한 뒤 변경 사항을 전달한다.”

Kafka·분산 시스템 설계 문서라면 `소비`와 `전파`가 정확한 전문 용어일 수 있으므로 바꾸지 않는다.
