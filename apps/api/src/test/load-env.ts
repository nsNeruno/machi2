import '../config/load-env';

// Pin the enqueue rate-limit tiers to the CLAUDE.md §6 production defaults so the
// throttling boundary assertions are deterministic, regardless of how a developer has
// loosened these in their local .env (see DEVELOPMENT.md §4). Runs before any test file
// imports AppModule, which reads these at module-evaluation time.
process.env.ENQUEUE_IP_LIMIT = '3';
process.env.ENQUEUE_IP_TTL_SECONDS = '60';
process.env.ENQUEUE_DEVICE_LIMIT = '1';
process.env.ENQUEUE_DEVICE_TTL_SECONDS = '5';
process.env.REJOIN_COOLDOWN_SECONDS = '30';
