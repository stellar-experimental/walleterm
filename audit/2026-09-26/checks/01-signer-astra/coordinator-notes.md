# Coordinator evidence status

The coordinator supplied these statements in the audit conversation on 2026-09-26.

- Initial baseline failures came from sandbox socket restrictions.
- Permitted baseline checks passed: Go race, Go vet, TypeScript, 224 Bun tests, and three contract self-tests.
- The coordinator named `checks/baseline-permitted-results.json` as the central evidence file.
- The coordinator requested no repeated full suites.
- The coordinator requested build caches outside the final audit directory.

This lane did not inspect the central evidence file.
This lane used only its assigned evidence directories.
The report attributes these baseline results to the coordinator.
