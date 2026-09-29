FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV APP_ORIGIN=http://localhost:3000
ENV DATABASE_URL=postgres://postgres:postgres@localhost:5432/luma_take_home
ENV BETTER_AUTH_SECRET=bld_x7YpQ8mR2vT5nL0sK3aD6fH9jC1uW4eZ
ENV BETTER_AUTH_URL=http://localhost:3000
ENV DEMO_MAYA_EMAIL=maya@example.test
ENV DEMO_MAYA_PASSWORD=local-maya-password
ENV DEMO_ELLIE_EMAIL=ellie@example.test
ENV DEMO_ELLIE_PASSWORD=local-ellie-password
ENV LUMA_PROVIDER=fake

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app /app

EXPOSE 3000

CMD ["npm", "run", "start"]
