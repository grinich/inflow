import {createContext,useContext} from 'react';
type Actions={
  editMessage:(conversationId:string,messageId:string,body:string)=>Promise<boolean>;
  reactToMessage:(conversationId:string,messageId:string,emoji:string)=>Promise<boolean>;
  recallMessage:(conversationId:string,messageId:string)=>Promise<boolean>;
};
export const ActionsContext=createContext<Actions|null>(null);
// Preserve the component contract, but acknowledge only completed MCP writes.
export function useOptimisticAction(){
  const actions=useContext(ActionsContext);
  if(!actions)throw new Error('Inflow actions provider is missing');
  return actions;
}
