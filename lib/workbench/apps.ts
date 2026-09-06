export const APP_CATALOG=[
 {slug:'googledocs',name:'Google Docs',description:'Read and write documents',icon:'https://logos.composio.dev/api/googledocs'},
 {slug:'googleslides',name:'Google Slides',description:'Create and edit presentations',icon:'https://logos.composio.dev/api/googleslides'},
 {slug:'googledrive',name:'Google Drive',description:'Find, organize, and export files',icon:'https://logos.composio.dev/api/googledrive'},
 {slug:'googlesheets',name:'Google Sheets',description:'Analyze and update spreadsheets',icon:'https://logos.composio.dev/api/googlesheets'},
 {slug:'notion',name:'Notion',description:'Pages and databases',icon:'https://logos.composio.dev/api/notion'},
 {slug:'github',name:'GitHub',description:'Issues, pull requests, and code',icon:'https://logos.composio.dev/api/github'},
 {slug:'slack',name:'Slack',description:'Channels and messages',icon:'https://logos.composio.dev/api/slack'},
 {slug:'gmail',name:'Gmail',description:'Find and prepare email',icon:'https://logos.composio.dev/api/gmail'},
 {slug:'linear',name:'Linear',description:'Issues and project planning',icon:'https://logos.composio.dev/api/linear'},
 {slug:'trello',name:'Trello',description:'Boards, lists, and cards',icon:'https://logos.composio.dev/api/trello'},
] as const;
export function validateAppSelection(value:unknown):string[]|undefined{if(value===undefined)return undefined;if(!Array.isArray(value)||value.length>8||value.some(s=>typeof s!=='string'||!APP_CATALOG.some(a=>a.slug===s)))throw new Error('Choose up to eight supported apps.');return [...new Set(value)] as string[];}
