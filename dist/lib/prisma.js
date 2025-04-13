"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalPrismaClient = void 0;
// lib/prisma.ts
const client_1 = require("@prisma/client");
const globalForPrisma = global;
exports.globalPrismaClient = globalForPrisma.globalPrismaClient || new client_1.PrismaClient();
if (process.env.NODE_ENV !== "production")
    globalForPrisma.globalPrismaClient = exports.globalPrismaClient;
