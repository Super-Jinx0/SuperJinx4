FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg
COPY *.js *.html *.css *.svg *.webmanifest package.json ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "index.js"]
