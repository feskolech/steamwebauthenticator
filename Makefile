COMPOSE = docker compose
BASE = -f docker-compose.yml
DEV = -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: dev build up deploy down lint test logs

dev:
	$(COMPOSE) $(DEV) up --build

build:
	$(COMPOSE) $(BASE) build

up:
	$(COMPOSE) $(BASE) up -d --build

deploy: up

down:
	$(COMPOSE) $(BASE) down --remove-orphans
	$(COMPOSE) $(DEV) down --remove-orphans

lint:
	$(COMPOSE) $(DEV) run --rm backend npm run lint
	$(COMPOSE) $(DEV) run --rm frontend npm run lint

test:
	$(COMPOSE) $(DEV) up -d mysql backend frontend
	$(COMPOSE) $(DEV) run --rm backend npm run test
	$(COMPOSE) $(DEV) run --rm cypress

logs:
	$(COMPOSE) $(BASE) logs -f --tail=200
