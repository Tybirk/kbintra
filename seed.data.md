1. Copy CSV to server:
  scp /home/tybirk/projects/kbintra/old_food_teams/all_persons.csv root@116.203.66.143:~/kbintra/

2. On the server, copy into container and run:
cd ~/kbintra
docker cp all_persons.csv kbintra-backend-1:/app/all_persons.csv
docker compose exec backend uv run python manage.py seed_users_from_csv /app/all_persons.csv