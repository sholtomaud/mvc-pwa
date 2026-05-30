ARG NODE_VERSION=25
FROM node:${NODE_VERSION}-slim

WORKDIR /app

ENV NODE_ENV=development
ENV CI=true
ENV NODE_OPTIONS=--max-old-space-size=3072

# Install Playwright system dependencies and Chromium browser
RUN apt-get update && \
    npx -y playwright@1.60.0 install chromium --with-deps && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

CMD ["bash"]
