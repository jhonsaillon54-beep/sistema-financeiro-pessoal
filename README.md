# Financly - Sistema de Gestão Financeira Pessoal

O **Financly** é um sistema moderno, rápido e seguro para controle financeiro pessoal. Ele foi desenvolvido com foco em privacidade (usando banco de dados local no navegador) e uma interface com design premium glassmorphic, responsivo para celular.

![Screenshot do Financly](https://raw.githubusercontent.com/jhons/Sistema-financeiro-pessoal/main/dashboard_preview.png) *(Substitua pelo link da sua imagem após publicar)*

---

## 🚀 Recursos Principais

- **Banco de Dados Local (IndexedDB)**: Nenhuma informação financeira é enviada a servidores externos. Tudo fica salvo de forma criptografada e segura no seu próprio navegador.
- **Sistema de Login Individual**: Acesso individualizado por usuário com hash de senha SHA-256 e pergunta de recuperação de segurança.
- **Painel de Controle Interativo (Time Travel)**:
  - Navegação entre meses anteriores e futuros.
  - Gráfico de linha de fluxo de caixa mostrando os últimos 12 meses.
  - Gráfico de rosca para ver a proporção de despesas por categoria.
  - Indicadores de Saldo Atual acumulativo, Receitas, Despesas e Taxa de Economia.
- **Metas de Orçamento por Categoria**: Defina limites mensais de gastos e acompanhe o progresso por barras coloridas dinâmicas.
- **Central de Notificações**: Mensagens e alertas estilizados (Toasts) substituindo as caixas nativas feias do navegador.
- **Portabilidade de Dados**:
  - Exportação e importação de backups completos em **JSON**.
  - Exportação de planilhas formatadas em **CSV** (compatível com Excel em português).
  - Exportação direta de **Resumo Financeiro em PDF** de forma limpa e automática.

---

## 🛠️ Tecnologias Utilizadas

- **HTML5**: Estruturação semântica e acessível.
- **CSS3 (Vanilla)**: Design System personalizado com variáveis CSS, layouts Flexbox/Grid, responsividade Mobile-First e animações fluidas.
- **JavaScript (ES6+)**: Controle de estado local, lógica de negócios, criptografia (Web Crypto API) e interações assíncronas com banco de dados.
- **IndexedDB**: Armazenamento relacional e transacional no lado do cliente.
- **Chart.js**: Renderização dos gráficos interativos.
- **html2pdf.js**: Geração e download direto dos relatórios em PDF.

---

## 💻 Como Rodar o Projeto Localmente

1. Faça o clone deste repositório:
   ```bash
   git clone https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
   ```
2. Acesse a pasta do projeto:
   ```bash
   cd NOME-DO-REPOSITORIO
   ```
3. Abra o arquivo `index.html` diretamente em qualquer navegador de sua preferência (Chrome, Edge, Firefox, Safari) ou utilize a extensão **Live Server** no VS Code.

---

## 📋 Como Publicar no GitHub (Passo a Passo)

Abra o seu terminal (Git Bash, Command Prompt ou PowerShell) na pasta do projeto e execute:

1. **Inicializar o repositório Git**:
   ```bash
   git init
   ```
2. **Adicionar os arquivos ao repositório**:
   ```bash
   git add .
   ```
3. **Criar o primeiro commit**:
   ```bash
   git commit -m "feat: commit inicial do sistema Financly"
   ```
4. **Vincular e enviar para o GitHub**:
   *(Substitua a URL abaixo com o link do repositório vazio que você criar no GitHub)*
   ```bash
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
   git push -u origin main
   ```
