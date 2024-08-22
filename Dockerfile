# Use a prebuilt Puppeteer image with Chrome installed
FROM buildkite/puppeteer:latest

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
