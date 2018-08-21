require('./patch-BigInt');

const { server } = require('./app');

server.listen(3000);
