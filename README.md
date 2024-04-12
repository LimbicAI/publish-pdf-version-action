# Medical Device Version PDF generator

This GitHub action is used in Limbic Access to generate a new PDF for each release.

### Usage

In a github actions file you can add this action using this configuration

```yaml
- name: Publish new IFU PDF
  uses: LimbicAI/publish-pdf-version-action@main
  with:
    region: <s3 region>
    accessKeyId: <aws key with read and write access to the bucket>
    secretAccessKey: <aws secret with read and write access to the bucket>
    pdfName: <new pdf name to save in versions folder>
    baseUrl: <public url>
    bucket: <s3 bucket>
    basePdf: <pdf to be appended>
    outputPdfKey: <key to save the new pdf>
```

### Required inputs

`bucket` - S3 bucket where the pdfs are stored.
`region` - S3 region the bucket belongs to
`accessKeyId` - aws access key with read and write access
`secretAccessKey` - aws secret with read and write access
`baseUrl` - Public domain where the PDFs will be available (the domain of the bucket).
`basePdf` - Name of the PDF file that will have the versions front page prepend to, this is relative to `s3://bucket/assets/`.
`pdfName` - Name of the new versioned pdf, expected to be in the format `M.m.p-dd-mm-yyyy` where `M`, `m`, `p` are major, minor and patch version numbers according to semver, and `dd-mm-yyyy` is the release date.
`outputPdfKey` - the key where to save the latest pdf, this is relative to `s3://bucket/`
