require('dotenv').config({ path: './.env' })

console.log("MONGODB_URI =", process.env.MONGODB_URI)

require('./bot')