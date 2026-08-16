/**
 * OpenTelemetry metrics for Aether Proxy.
 *
 * Uses the @opentelemetry/api no-op implementation by default.
 * Metrics flow to a real backend only when an OTel SDK is registered at
 * startup (e.g. via @opentelemetry/sdk-node with a Prometheus or OTLP exporter).
 * No SDK configuration required for the proxy to start — metrics are silently
 * dropped when no exporter is present.
 */
import { metrics } from '@opentelemetry/api';

import type { Complexity } from './complexity-router';

const meter = metrics.getMeter('aether-proxy', '0.1.1');

// Total circuit breaker trips, tagged by trip reason.
// reason='tool_loop'  — repeated tool call detected in conversation history
// reason='burst_rate' — request flood or token burst in the sliding window
const cbTrippedTotal = meter.createCounter('aether_circuit_breaker_tripped_total', {
  description: 'Total number of circuit breaker trips.',
  unit:        '{trip}',
});

// Distribution of request complexity classifications.
// complexity='simple'  — routed to local/cheap model (or passed through)
// complexity='complex' — routed to primary cloud LLM API
const complexityDistribution = meter.createCounter('aether_router_complexity_distribution', {
  description: 'Count of requests by complexity classification.',
  unit:        '{request}',
});

export function recordCircuitBreakerTrip(reason: 'tool_loop' | 'burst_rate'): void {
  cbTrippedTotal.add(1, { reason });
}

export function recordComplexity(complexity: Complexity): void {
  complexityDistribution.add(1, { complexity });
}
