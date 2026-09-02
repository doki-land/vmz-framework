/**
 * Internal probe for `skip-native-pre`: body must be trivial; the contract under
 * test is `pre: build:runtimes` short-circuit when `VMZ_SKIP_NATIVE_BUILD=1`.
 */
console.log('skip-native-pre-probe PASS');
