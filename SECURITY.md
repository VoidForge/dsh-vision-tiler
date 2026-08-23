# Security Policy

## Supported version

Security fixes target the latest published release.

## Reporting

Please do not publish secrets, private documents, or a working exploit in a public issue. Use GitHub's private vulnerability reporting for this repository when available. Otherwise, open a minimal issue that contains no sensitive payload and asks the maintainer for a private contact channel.

## Data handling

The plugin reads only the image path supplied to `segment_image`, performs processing locally inside the DSH process, and returns generated attachments to Harness. It does not upload files independently. The configured vision provider may receive those attachments as part of the normal DSH model request; its own privacy terms still apply.

Images above 100,000,000 decoded pixels are rejected to limit decompression-bomb risk. Consumers should still restrict filesystem access and run DSH with the least privileges needed.
