# Certificates

`rds-global-bundle.pem` is Amazon's public root bundle for RDS, from
<https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem>.

It is committed on purpose. It is public, it contains no secret, and a
deployment that has to fetch it at start-up is a deployment that fails when
that fetch fails. Referenced from `DATABASE_URL` as
`sslmode=verify-full&sslrootcert=./certs/rds-global-bundle.pem`, which checks
both the certificate chain and the hostname.

Without it, connecting to RDS fails with "self-signed certificate in
certificate chain" — the chain is fine, we simply do not trust its root yet.

Refresh it when AWS rotates roots; the URL above always serves the current
bundle.
