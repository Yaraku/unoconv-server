FROM telemark/docker-node-unoconv

RUN apt-get update && apt-get install -y \
    fonts-vlgothic \
    fonts-ipafont-gothic \
    fonts-ipafont-mincho  \
    fonts-kacst \
    fonts-wqy-zenhei \
    fonts-baekmuk \
    fonts-sil-padauk \
    fonts-thai-tlwg \
    fonts-tlwg-garuda \
    fonts-tlwg-kinnari \
    fonts-tlwg-loma \
    fonts-tlwg-norasi \
    fonts-tlwg-umpush \
    fonts-tlwg-waree

RUN apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

ENV HOSTNAME 0.0.0.0
ENV PORT 4000

RUN yarn && yarn cache clean

EXPOSE 4000

CMD ["start"]

ENTRYPOINT ["./unoconv-server"]
