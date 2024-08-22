FROM node:14-slim

# Install latest chrome dev package and fonts to support major charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
# Note: this installs the necessary libs to make the bundled version of Chromium that Puppeteer
# installs, work.
RUN apt-get update \
    && apt-get install -y wget gnupg chromium --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY src/ /
COPY package.json /
COPY package-lock.json /

RUN npm install
RUN fc-cache -fv && \
    chmod +x /index.js && \
    ln -s /index.js /usr/local/bin/publish-pdf-version-action && \
    ls -a && \
    pwd

CMD [ "publish-pdf-version-action" ]
