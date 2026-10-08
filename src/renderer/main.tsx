import React from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import 'katex/dist/katex.min.css';
import { App } from './App';
import './styles.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}> {state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message}}render(){return this.state.error?<div className="startup"><h1>Planner could not render this view</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Reload</button></div>:this.props.children}}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
