"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const socket_io_1 = require("socket.io");
const node_http_1 = require("node:http");
const redis_1 = require("redis");
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("./lib/prisma");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = (0, node_http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: `${process.env.NEXT_URL}`,
        credentials: true,
        methods: ['GET', 'POST', 'PUT']
    }
});
const client = (0, redis_1.createClient)({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: retries => {
            if (retries > 5)
                return new Error('Too many retries but server still not being able to connect to server');
            return Math.min(retries * 50, 500);
        }
    }
});
app.get('/', (req, res) => {
    res.send("Hello there");
});
client.on('error', (err) => {
    console.error('Redis Client Error:', err);
});
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const prisma = prisma_1.globalPrismaClient;
        try {
            yield client.connect();
            console.log("Connected to Redis server");
            setInterval(() => {
                client.ping().catch(console.error);
            }, 60000);
            io.on('connection', (socket) => {
                console.log(`New client connected: ${socket.id}`);
                socket.on('codeRequestQueue', (req) => {
                    console.log('data received, now sending to worker');
                    client.lPush('submissions', JSON.stringify(req));
                });
                // testing purposes
                socket.on('welcome', (obj) => {
                    const socketId = obj.socketId;
                    const runnerType = obj.runnerType;
                    const status = obj.status;
                    console.log('now my turn comes again....');
                    socket.to(socketId).emit('welcome', (status));
                });
                socket.on('workerCallback', (obj) => __awaiter(this, void 0, void 0, function* () {
                    console.log('sent to : ' + obj.socketId);
                    socket.to(obj.socketId).emit('codeResponse', obj);
                    if (obj.runnerType === 'submit') {
                        console.log('Submission submitted');
                        const submitStatus = obj.status.includes('Accepted') ? 'Accepted' : obj.status.includes('Wrong Answer') ? 'Wrong Answer' : obj.status.includes('Compilation Error') ? 'Compilation Error' : obj.status.includes('Runtime Error') ? 'Runtime Error' : obj.status.includes('TLE') ? 'Time Limit Reached' : 'Unknown';
                        let submissionDate = new Date(obj.submissionTime);
                        let today = new Date(Date.UTC(submissionDate.getUTCFullYear(), submissionDate.getUTCMonth(), submissionDate.getUTCDate()));
                        let firstDayOfMonth = new Date(Date.UTC(submissionDate.getUTCFullYear(), submissionDate.getUTCMonth(), 1));
                        try {
                            yield prisma.monthlyActivity.upsert({
                                where: { userId_date: { userId: obj.userId, date: firstDayOfMonth } },
                                update: {},
                                create: { userId: obj.userId, date: firstDayOfMonth }
                            });
                            const userDailyActivity = yield prisma.dailyActivity.findUnique({
                                where: {
                                    userId_date: {
                                        userId: obj.userId, date: today
                                    },
                                },
                                select: {
                                    acceptedSubmissions: true
                                }
                            });
                            const increaseStreak = ((!userDailyActivity && submitStatus === 'Accepted') || (userDailyActivity && userDailyActivity.acceptedSubmissions === 0)) ? true : false;
                            if (increaseStreak) {
                                yield prisma.notification.create({
                                    data: {
                                        userId: obj.userId,
                                        message: 'Successfully Completed Daily Challenge'
                                    }
                                });
                            }
                            yield prisma.dailyActivity.upsert({
                                where: { userId_date: { userId: obj.userId, date: today } },
                                update: submitStatus === 'Accepted' ?
                                    { totalSubmissions: { increment: 1 }, acceptedSubmissions: { increment: 1 } } :
                                    { totalSubmissions: { increment: 1 } },
                                create: {
                                    userId: obj.userId,
                                    date: today,
                                    totalSubmissions: 1,
                                    acceptedSubmissions: submitStatus === 'Accepted' ? 1 : 0,
                                    month: firstDayOfMonth
                                }
                            });
                            yield prisma.submission.create({
                                data: {
                                    userId: obj.userId,
                                    problemURL: obj.problemURL,
                                    code: obj.code,
                                    language: obj.language,
                                    status: submitStatus,
                                    submittedAt: obj.submissionTime,
                                    today: today
                                }
                            });
                            const res = yield prisma.user.findUnique({
                                where: { id: obj.userId },
                                select: { solvedProblems: true, skills: true }
                            });
                            let alreadySolved = false;
                            if (res && res.solvedProblems) {
                                for (const p of res.solvedProblems) {
                                    if (p === obj.problemURL) {
                                        alreadySolved = true;
                                        break;
                                    }
                                }
                            }
                            let pendingSkills = [...new Set([...((res === null || res === void 0 ? void 0 : res.skills) || []), ...((obj === null || obj === void 0 ? void 0 : obj.topics) || [])])];
                            if (obj === null || obj === void 0 ? void 0 : obj.topics) {
                                console.log('topics : ', obj.topics);
                                if (res === null || res === void 0 ? void 0 : res.skills) {
                                    console.log('user has already : ', res.skills);
                                    console.log('pending skills : ', pendingSkills);
                                }
                            }
                            if (submitStatus === 'Accepted') {
                                if (alreadySolved) {
                                    if (obj.difficulty === 'Easy') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                duplicateTotalSubmissions: { increment: 1 },
                                                duplicateAcceptedSubmissions: { increment: 1 },
                                                duplicateAcceptedEasy: { increment: 1 },
                                                duplicateTotalEasy: { increment: 1 },
                                                skills: pendingSkills,
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                    else if (obj.difficulty === 'Medium') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                duplicateTotalSubmissions: { increment: 1 },
                                                duplicateAcceptedSubmissions: { increment: 1 },
                                                duplicateAcceptedMedium: { increment: 1 },
                                                duplicateTotalMedium: { increment: 1 },
                                                skills: pendingSkills,
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                    else if (obj.difficulty === 'Hard') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                duplicateTotalSubmissions: { increment: 1 },
                                                duplicateAcceptedSubmissions: { increment: 1 },
                                                duplicateAcceptedHard: { increment: 1 },
                                                duplicateTotalHard: { increment: 1 },
                                                skills: pendingSkills,
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                }
                                else {
                                    if (obj.difficulty === 'Easy') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                solvedProblems: { push: obj.problemURL },
                                                totalSubmissions: { increment: 1 },
                                                acceptedSubmissions: { increment: 1 },
                                                acceptedEasy: { increment: 1 },
                                                totalEasy: { increment: 1 },
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                    else if (obj.difficulty === 'Medium') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                solvedProblems: { push: obj.problemURL },
                                                totalSubmissions: { increment: 1 },
                                                acceptedSubmissions: { increment: 1 },
                                                acceptedMedium: { increment: 1 },
                                                totalMedium: { increment: 1 },
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                    else if (obj.difficulty === 'Hard') {
                                        yield prisma.user.update({
                                            where: {
                                                id: obj.userId
                                            },
                                            data: {
                                                solvedProblems: { push: obj.problemURL },
                                                totalSubmissions: { increment: 1 },
                                                acceptedSubmissions: { increment: 1 },
                                                acceptedHard: { increment: 1 },
                                                totalHard: { increment: 1 },
                                                activeDays: { increment: increaseStreak ? 1 : 0 },
                                                currentStreak: { increment: increaseStreak ? 1 : 0 }
                                            }
                                        });
                                    }
                                }
                                yield prisma.problem.update({
                                    where: {
                                        problemURL: obj.problemURL
                                    },
                                    data: {
                                        acceptedSubmissions: { increment: 1 },
                                        totalSubmissions: { increment: 1 }
                                    }
                                });
                            }
                            else {
                                if (obj.difficulty === 'Easy') {
                                    yield prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            totalSubmissions: { increment: 1 },
                                            totalEasy: { increment: 1 },
                                            skills: pendingSkills,
                                            activeDays: { increment: increaseStreak ? 1 : 0 },
                                        }
                                    });
                                }
                                else if (obj.difficulty === 'Medium') {
                                    yield prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            totalSubmissions: { increment: 1 },
                                            totalMedium: { increment: 1 },
                                            skills: pendingSkills,
                                            activeDays: { increment: increaseStreak ? 1 : 0 },
                                        }
                                    });
                                }
                                else if (obj.difficulty === 'Hard') {
                                    yield prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            totalSubmissions: { increment: 1 },
                                            totalHard: { increment: 1 },
                                            skills: pendingSkills,
                                            activeDays: { increment: increaseStreak ? 1 : 0 },
                                        }
                                    });
                                }
                                yield prisma.problem.update({
                                    where: {
                                        problemURL: obj.problemURL
                                    },
                                    data: {
                                        totalSubmissions: { increment: 1 }
                                    }
                                });
                            }
                        }
                        catch (error) {
                            console.log(error);
                            socket.to(obj.socketId).emit('welcome', error);
                        }
                    }
                }));
                socket.on('disconnect', () => {
                    console.log(`Client disconnected: ${socket.id}`);
                });
            });
        }
        catch (error) {
            console.log(`Error: ${error}`);
        }
    });
}
main();
server.listen(process.env.PORT, () => console.log('Server is running on port ' + process.env.PORT));
