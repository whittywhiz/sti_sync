This is our capstone project for STI College Malolos. It's an automated class scheduling system that uses a Genetic Algorithm to generate conflict-free schedules based on professors' availability, room types, section sizes, and curriculum data.

## Getting Started

You'll need Node.js, PostgreSQL, and npm installed. The database should be named `sti_sync`.

First, set up your environment variables. Go into the `server` folder, make a copy of `.env.example`, and rename it to `.env`. Then fill in your actual database password and details.

```
cd server
copy .env.example .env
```

After that, set up the database. A `schema.sql` file is included in the root of the repo. Run it against your PostgreSQL to create all the tables:

```
psql -U postgres -d sti_sync -f schema.sql
```

It will ask for your PostgreSQL password. This creates all 13 tables with the correct columns, constraints, indexes, and relationships. You only need to do this once.

Then install dependencies for both the server and the client:

```
cd server
npm install

cd ../client
npm install
```

---

## Running the App

You need two terminals open at the same time.

In the first terminal, start the backend:

```
cd server
npm run dev
```

In the second terminal, start the frontend:

```
cd client
npm run dev
```

Backend runs at http://localhost:3000 and the frontend at http://localhost:8080. The frontend automatically forwards API requests to the backend.

## Test Scripts

These are standalone scripts you can run to test the scheduling engine directly without going through the browser. Make sure the backend `.env` is set up and PostgreSQL is running first.

**test-real-data** — pulls live data from the database, runs the full GA, and prints the best schedule it found along with any remaining violations:

```
cd server
npx ts-node src/test-real-data.ts
```

If everything is working, you should see `Best fitness found: 0` and an empty violations list at the end. That means it found a clean, conflict-free schedule.

---

## Type Checking

If you made changes to the code and want to make sure nothing is broken:

```
cd server
npx tsc --noEmit
```

No output means no errors.

---
