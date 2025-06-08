FROM oven/bun:debian
RUN apt-get update && apt-get upgrade -y && apt-get install -y curl wget bash build-essential
RUN mkdir -p /app
# Enable this if you're using this in production
#COPY ./ /app
WORKDIR /app
CMD [ "bun", "run", "start" ]