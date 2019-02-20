FROM telemark/docker-node-unoconv

RUN git clone https://github.com/Yaraku/unoconv-server.git app

WORKDIR /app

ENV HOSTNAME 0.0.0.0
ENV PORT 4000

RUN yarn && yarn cache clean

EXPOSE 4000

CMD ["start"]

ENTRYPOINT ["./unoconv-server"]
