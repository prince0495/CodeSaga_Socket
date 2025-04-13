export interface ServerToClientEvents {
    noArg: () => void;
    basicEmit: (a: number, b: string, c: Buffer) => void;
    withAck: (d: string, callback: (e: number) => void) => void;
    codeRequestQueue: (req: codeRequest) => void;
    welcome: (arg: any) => void;
    workerCallback: (obj: CodeCallback) => void;
    codeResponse: (obj: CodeCallback) => void;
  }
  
export  interface ClientToServerEvents {
    hello: () => void;
    welcome: (arg: any) => void;
    workerCallback: (obj: CodeCallback) => void;
    codeResponse: (obj: CodeCallback) => void;
  }
  
export  interface InterServerEvents {
    ping: () => void;
  }
  
export  interface SocketData {
    name: string;
    age: number;
  }


  export  type codeRequest = {
    language: string;
    code: string;
    socketId: string;
    problemTitle: string;
    runnerType: string;
    submissionTime: Date;
    userId: string;
    problemURL: string;
    difficulty: string;
    topics: string[] | undefined;
  }

  export type CodeCallback = {status: string, language: string, code: string, socketId: string,  problemTitle: string, runnerType: string, submissionTime: Date, userId: string, problemURL: string, difficulty: string, topics: string[] | undefined}
