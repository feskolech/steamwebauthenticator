COMPOSE = docker compose
BASE = -f docker-compose.yml
DEV = -f docker-compose.yml -f docker-compose.dev.yml
TEST = -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml
TEST_PROJECT = -p steamguard_test

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
	$(COMPOSE) $(TEST_PROJECT) $(DEV) run --rm --no-deps backend npm run lint
	$(COMPOSE) $(TEST_PROJECT) $(DEV) run --rm --no-deps frontend npm run lint

test:
	@set -e; \
	trap '$(COMPOSE) $(TEST_PROJECT) $(TEST) down --remove-orphans' EXIT; \
	$(COMPOSE) $(TEST_PROJECT) $(TEST) up -d mysql redis backend frontend; \
	$(COMPOSE) $(TEST_PROJECT) $(TEST) run --rm backend npm run test -- --forceExit; \
	$(COMPOSE) $(TEST_PROJECT) $(TEST) run --rm --no-deps -e TELEGRAM_BOT_TOKEN= telegram-bot python -m unittest discover -s tests -v; \
	$(COMPOSE) $(TEST_PROJECT) $(TEST) run --rm cypress

logs:
	$(COMPOSE) $(BASE) logs -f --tail=200
