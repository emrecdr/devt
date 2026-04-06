# Quality Gates — Go

## Gate 1: Linting

```bash
golangci-lint run ./...
```

Runs configured linters (errcheck, govet, staticcheck, etc.). Fix all findings.

## Gate 2: Vet

```bash
go vet ./...
```

Catches suspicious constructs: unreachable code, bad format strings, mutex copy.

## Gate 3: Tests

```bash
go test ./... -race -count=1
```

Runs all unit tests with race detector enabled. `-count=1` disables test caching.

## Gate 4: Vulnerability Check

```bash
govulncheck ./...
```

Checks dependencies against the Go vulnerability database. Catches known CVEs. Install: `go install golang.org/x/vuln/cmd/govulncheck@latest`

## Pass Criteria

- All gates must exit with code 0
- Any non-zero exit code = gate failure
- Run all gates before pushing code

## Quick Reference

Run all gates sequentially:

```bash
golangci-lint run ./... && go vet ./... && go test ./... -race -count=1 && govulncheck ./...
```

## Optional Gate 5: Integration Tests

```bash
go test -tags=integration ./... -race -count=1
```
