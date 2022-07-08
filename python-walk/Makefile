install-dev:
	poetry install

clean:
	find . -name "*.pyc" -exec rm -f {} \;

format:
	black .

prep:
	poetry export -f requirements.txt --without-hashes --output requirements.txt

run:
	poetry run uvicorn main:app --debug