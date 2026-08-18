# Third-party notices

Files vendored into this repository from third-party projects, with the license
terms they are distributed under. Redistributing these files in source form
requires retaining the copyright notice, the license conditions, and the
disclaimer below.

Anything listed here is a copy of an external artifact, kept byte-identical to
upstream (see `.prettierignore`). Do not edit these files locally — update them by
re-vendoring from upstream and updating the pinned commit here.

---

## jupyter/nbformat — Jupyter Notebook format JSON Schema

**Vendored file:** `src/features/notebook/persistence/__fixtures__/nbformat.v4.5.schema.json`
**Upstream:** https://github.com/jupyter/nbformat — `nbformat/v4/nbformat.v4.5.schema.json`
**Pinned upstream commit:** [`c419830da3dd3ea9045a13cdce81e397d173c8b2`](https://github.com/jupyter/nbformat/commit/c419830da3dd3ea9045a13cdce81e397d173c8b2) (2022-04-02, the last commit to touch this file)
**SHA-256 of the vendored copy:** `523e3578ddbfcad52933d2423dc5951114ef73f48df180b6a601498ba5ca071a`
**Used for:** test-only structural validation of the `.ipynb` export
(`__fixtures__/nbformatSchema.ts`). Not part of the production bundle.
**License:** BSD 3-Clause

```text
BSD 3-Clause License

- Copyright (c) 2001-2015, IPython Development Team
- Copyright (c) 2015-, Jupyter Development Team

All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
