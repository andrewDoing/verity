# Blob Storage Connector Contract

The first release is filesystem-first. Blob storage is represented as a future connector boundary, not as implemented cloud integration.

## Connector shape

Every storage connector must support:

- `listArtifacts(uri)`: enumerate artifacts under a container or folder URI.
- `readArtifact(uri)`: return artifact bytes or text plus metadata.
- `writeArtifact(uri, content)`: write a reviewed artifact.
- `getMetadata(uri)`: return size, modified time, content type, and connector-specific metadata.

## URI strategy

The renderer works with opaque artifact URIs. The MVP implements `file://` URIs. Future connectors can add `azure-blob://`, `s3://`, or customer-specific schemes without changing Trace, GT, Eval, search, or annotation UI flows.

## Explicitly out of scope for the first release

- Cloud credentials.
- Remote browsing.
- Blob write-back.
- Signed URL management.
- Customer-specific auth policy.
