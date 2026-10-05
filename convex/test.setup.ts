/**
 * convex-test hands each Convex function the env of the test module, so this is
 * where the deployment's secrets come from during a run. Nothing here is a real
 * credential: the Google calls are stubbed at `fetch`, and the token endpoint
 * only has to answer with something shaped like a Clerk token.
 */
process.env.CLERK_SECRET_KEY = 'sk_test_not_a_real_secret'
