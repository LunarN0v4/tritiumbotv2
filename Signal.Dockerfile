FROM debian:bookworm
RUN mkdir -p /app
RUN mkdir -p /app/config
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && apt-get install -y curl wget bash build-essential
RUN wget https://download.oracle.com/java/21/latest/jdk-21_linux-x64_bin.deb
RUN dpkg -i jdk-21_linux-x64_bin.deb
RUN rm -rf ./jdk-21_linux-x64_bin.deb
RUN wget https://github.com/AsamK/signal-cli/releases/download/v0.13.15/signal-cli-0.13.15.tar.gz -O tmp.tar.gz
RUN tar -xvf tmp.tar.gz
RUN mv ./signal-cli-0.13.15/bin/* /usr/local/bin/
RUN mv ./signal-cli-0.13.15/lib/* /usr/local/lib/
RUN rm -rf ./signal-cli-0.13.15
RUN rm -rf ./tmp.tar.gz
RUN apt-get update && apt-get upgrade -y && apt-get clean
CMD [ "signal-cli", "--config", "/app/config", "daemon", "--tcp", "0.0.0.0:64", "--receive-mode", "on-connection" ]