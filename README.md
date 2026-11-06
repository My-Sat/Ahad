# Ahad

Run `npm install`, then `npm start` (or `npm run dev` for automatic restarts).
Open http://localhost:3001. Both `server.js` and `bin/www` default to port 3001
so Ahad can run alongside Ahad-EMP-Backend on port 3000.

To use another port, set `PORT` in `.env` or the process environment.
Restart the app after changing it. The chosen port must be available.

## ClassOne printing bridge

Set `CLASSONE_BRIDGE_KEY` to a random secret of at least 32 characters in Ahad. Set the **same**
secret as `AHAD_BRIDGE_KEY` in the ClassOne backend and set its
`AHAD_BASE_URL=http://localhost:3001` for local testing. Use the Ahad HTTPS
service URL for deployment. Never put the key in the frontend or commit it.

The bridge receives verified ClassOne receipts and confirmed print jobs only.
Receipts enter the selected Ahad cash book as customer advances; revenue is
recognized when each question paper is confirmed printed. Reprints and marking
schemes add printer usage but no new revenue. The Ahad POS `/orders` route is
not used, so ClassOne invoices are not priced a second time.
