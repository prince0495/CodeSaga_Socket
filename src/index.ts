import express from 'express'
import { Server } from 'socket.io'
import { createServer } from 'node:http'
import { createClient } from 'redis'
import dotenv from 'dotenv'
import { ClientToServerEvents, codeRequest, InterServerEvents, ServerToClientEvents, SocketData } from './types'
import { globalPrismaClient } from './lib/prisma'
dotenv.config()

const app = express()
const server = createServer(app)
const io = new Server<
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData
>(server, {
    cors: {
        origin: `${process.env.NEXT_URL}`,
        credentials: true,
        methods: ['GET', 'POST', 'PUT']
    }
})
const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: retries => {
            if(retries > 5) return new Error('Too many retries but server still not being able to connect to server')
                return Math.min(retries*50, 500)
        }
    }
})

app.get('/', (req, res) => {
    res.send("Hello there")
})

client.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

async function main() {
    const prisma = globalPrismaClient;
    try {
        await client.connect()
        console.log("Connected to Redis server");

        setInterval(() => {
            client.ping().catch(console.error);
        }, 60000);

        io.on('connection', (socket)=> {
            console.log(`New client connected: ${socket.id}`);

            socket.on('codeRequestQueue', (req: codeRequest) => {
                console.log('data received, now sending to worker');
               client.lPush('submissions', JSON.stringify(req))
            })

            // testing purposes
            socket.on('welcome', (obj) => {
                const socketId = obj.socketId;
                const runnerType = obj.runnerType;
                const status = obj.status;
                console.log('now my turn comes again....');
                socket.to(socketId).emit('welcome', (status))
            })
            
            socket.on('workerCallback', async (obj) => {
                console.log('sent to : '+obj.socketId);
                socket.to(obj.socketId).emit('codeResponse', obj)
                if(obj.runnerType === 'submit') {
                    console.log('Submission submitted');
                    const submitStatus = obj.status.includes('Accepted') ? 'Accepted' : obj.status.includes('Wrong Answer') ? 'Wrong Answer' : obj.status.includes('Compilation Error') ? 'Compilation Error' : obj.status.includes('Runtime Error') ? 'Runtime Error' : obj.status.includes('TLE') ? 'Time Limit Reached' : 'Unknown'; 
                    let submissionDate = new Date(obj.submissionTime)
                    let today = new Date(Date.UTC(submissionDate.getUTCFullYear(), submissionDate.getUTCMonth(), submissionDate.getUTCDate()));
                    let firstDayOfMonth = new Date(Date.UTC(submissionDate.getUTCFullYear(), submissionDate.getUTCMonth(), 1));
                    try {
                        await prisma.monthlyActivity.upsert({
                            where: { userId_date: { userId: obj.userId, date: firstDayOfMonth } },
                            update: {},
                            create: { userId: obj.userId, date: firstDayOfMonth }
                        });
                        const userDailyActivity = await prisma.dailyActivity.findUnique({
                            where: {
                                userId_date: {
                                    userId: obj.userId, date: today
                                },
                            },
                            select: {
                                acceptedSubmissions: true
                            }
                        })
                        const increaseStreak = ((!userDailyActivity && submitStatus==='Accepted') || (userDailyActivity && userDailyActivity.acceptedSubmissions === 0)) ? true : false;
                        if(increaseStreak) {
                            await prisma.notification.create({
                                data: {
                                    userId: obj.userId,
                                    message: 'Successfully Completed Daily Challenge'
                                }
                            })
                        }
                        await prisma.dailyActivity.upsert({
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
                        await prisma.submission.create({
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
                        const res = await prisma.user.findUnique({
                            where: { id: obj.userId },
                            select: { solvedProblems: true, skills: true }
                        });
                        let alreadySolved = false;
                        if(res && res.solvedProblems) {
                            for(const p of res.solvedProblems) {
                                if(p === obj.problemURL) {
                                    alreadySolved = true;
                                    break;
                                }
                            }
                        }
                        let pendingSkills = [...new Set([...(res?.skills || []), ...(obj?.topics || [])])]
                        if(obj?.topics) {
                            console.log('topics : ',obj.topics);
                            if(res?.skills) {
                                console.log('user has already : ', res.skills);
                                console.log('pending skills : ', pendingSkills);
                            }
                        }
                        if(submitStatus==='Accepted') {
                            if(alreadySolved) {
                                if(obj.difficulty === 'Easy') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            duplicateTotalSubmissions: { increment: 1 },
                                            duplicateAcceptedSubmissions: { increment: 1 },
                                            duplicateAcceptedEasy: {increment: 1},
                                            duplicateTotalEasy: {increment: 1},
                                            skills: pendingSkills,
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                                else if(obj.difficulty === 'Medium') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            duplicateTotalSubmissions: { increment: 1 },
                                            duplicateAcceptedSubmissions: { increment: 1 },
                                            duplicateAcceptedMedium: {increment: 1},
                                            duplicateTotalMedium: {increment: 1},
                                            skills: pendingSkills,
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                                else if(obj.difficulty === 'Hard') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            duplicateTotalSubmissions: { increment: 1 },
                                            duplicateAcceptedSubmissions: { increment: 1 },
                                            duplicateAcceptedHard: {increment: 1},
                                            duplicateTotalHard: {increment: 1},
                                            skills: pendingSkills,
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                            }
                            else {
                                if(obj.difficulty === 'Easy') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            solvedProblems: { push: obj.problemURL },
                                            totalSubmissions: { increment: 1 },
                                            acceptedSubmissions: { increment: 1 },
                                            acceptedEasy: {increment: 1},
                                            totalEasy: {increment: 1},
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                                else if(obj.difficulty === 'Medium') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            solvedProblems: { push: obj.problemURL },
                                            totalSubmissions: { increment: 1 },
                                            acceptedSubmissions: { increment: 1 },
                                            acceptedMedium: {increment: 1},
                                            totalMedium: {increment: 1},
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                                else if(obj.difficulty === 'Hard') {
                                    await prisma.user.update({
                                        where: {
                                            id: obj.userId
                                        },
                                        data: {
                                            solvedProblems: { push: obj.problemURL },
                                            totalSubmissions: { increment: 1 },
                                            acceptedSubmissions: { increment: 1 },
                                            acceptedHard: {increment: 1},
                                            totalHard: {increment: 1},
                                            activeDays: {increment: increaseStreak ? 1 : 0},
                                            currentStreak: {increment: increaseStreak ? 1 : 0}
                                        }
                                    })
                                }
                            }
                            await prisma.problem.update({
                                where: {
                                    problemURL: obj.problemURL
                                },
                                data: {
                                    acceptedSubmissions: {increment: 1},
                                    totalSubmissions: {increment: 1}
                                }
                            })
                        }
                        else {
                            if(obj.difficulty === 'Easy') {
                                await prisma.user.update({
                                    where: {
                                        id: obj.userId
                                    },
                                    data: {
                                        totalSubmissions: {increment: 1},
                                        totalEasy: {increment: 1},
                                        skills: pendingSkills,
                                        activeDays: {increment: increaseStreak ? 1 : 0},
                                    }
                                })
                            }
                            else if(obj.difficulty === 'Medium') {
                                await prisma.user.update({
                                    where: {
                                        id: obj.userId
                                    },
                                    data: {
                                        totalSubmissions: {increment: 1},
                                        totalMedium: {increment: 1},
                                        skills: pendingSkills,
                                        activeDays: {increment: increaseStreak ? 1 : 0},
                                    }
                                })
                            }
                            else if(obj.difficulty === 'Hard') {
                                await prisma.user.update({
                                    where: {
                                        id: obj.userId
                                    },
                                    data: {
                                        totalSubmissions: {increment: 1},
                                        totalHard: {increment: 1},
                                        skills: pendingSkills,
                                        activeDays: {increment: increaseStreak ? 1 : 0},
                                    }
                                })
                            }
                            await prisma.problem.update({
                                where: {
                                    problemURL: obj.problemURL
                                },
                                data: {
                                    totalSubmissions: {increment: 1}
                                }
                            })
                        }
                    } catch (error) {
                        console.log(error);
                        socket.to(obj.socketId).emit('welcome',error)
                    }
                }
            })
            
            socket.on('disconnect', ()=> {
                console.log(`Client disconnected: ${socket.id}`);
            })
        })
    } catch (error) {
        console.log(`Error: ${error}`);
    }
}
main()

server.listen(process.env.PORT, ()=> console.log('Server is running on port ' + process.env.PORT))