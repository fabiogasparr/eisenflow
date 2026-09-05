import { Link } from 'react-router-dom';
import { PaginaPublica } from '@/components/PaginaPublica';

export default function Termos() {
  return (
    <PaginaPublica titulo="Termos de Serviço" atualizadoEm="5 de setembro de 2026">
      <p>
        Estes termos regem o uso do <strong>EisenFlow</strong>, oferecido por{' '}
        <strong>KZ3 Consultoria em Tecnologia Ltda</strong>, CNPJ 50.812.328/0001-80, São Roque/SP.
        Ao criar uma conta, você concorda com eles.
      </p>

      <h2>O que o serviço é</h2>
      <p>
        Um aplicativo web de organização de tarefas pela Matriz de Eisenhower, com integrações
        opcionais de Google Calendar, WhatsApp e recursos assistidos por inteligência artificial. É
        uma ferramenta de apoio à sua decisão — as sugestões automáticas são sugestões, e a escolha
        final é sempre sua.
      </p>

      <h2>Sua conta</h2>
      <ul>
        <li>Você precisa de um e-mail válido e de ter ao menos 16 anos.</li>
        <li>Você é responsável por manter a senha em segurança e pelo que acontece na sua conta.</li>
        <li>Avise-nos se suspeitar de uso indevido.</li>
      </ul>

      <h2>Uso aceitável</h2>
      <p>Ao usar o EisenFlow, você concorda em não:</p>
      <ul>
        <li>violar a lei ou direitos de terceiros;</li>
        <li>enviar spam ou mensagens não solicitadas pela integração de WhatsApp;</li>
        <li>tentar burlar limites, autenticação ou o isolamento entre contas e organizações;</li>
        <li>sobrecarregar deliberadamente a infraestrutura ou automatizar acesso de forma abusiva.</li>
      </ul>

      <h2>Seu conteúdo</h2>
      <p>
        As tarefas, anexos e demais dados que você cria continuam seus. Você nos concede apenas a
        licença necessária para armazenar, processar e exibir esse conteúdo a você e a quem você
        compartilhar, com o fim de operar o serviço.
      </p>

      <h2>Integrações de terceiros</h2>
      <p>
        As conexões com Google e WhatsApp são opcionais e ligadas por você, e ficam sujeitas também
        aos termos desses provedores. Podemos perder acesso a elas se o provedor mudar suas regras ou
        revogar a autorização — quando isso acontecer, o restante do EisenFlow continua funcionando.
        O que fazemos com os dados dessas conexões está na{' '}
        <Link to="/privacidade" className="text-primary underline underline-offset-4">
          Política de Privacidade
        </Link>
        .
      </p>

      <h2>Disponibilidade e mudanças</h2>
      <p>
        Fazemos o possível para manter o serviço no ar, mas ele é fornecido "como está", sem garantia
        de disponibilidade ininterrupta. Podemos alterar, suspender ou encerrar recursos; se a mudança
        for relevante, avisamos com antecedência razoável.
      </p>

      <h2>Limitação de responsabilidade</h2>
      <p>
        Na medida permitida pela lei, não respondemos por lucros cessantes, perda de dados ou danos
        indiretos decorrentes do uso do serviço. Nada aqui afasta direitos que a legislação brasileira
        assegure a você, especialmente como consumidor.
      </p>

      <h2>Encerramento</h2>
      <p>
        Você pode encerrar sua conta quando quiser, pelo contato abaixo. Podemos suspender contas que
        violem estes termos, com aviso quando for possível.
      </p>

      <h2>Lei aplicável</h2>
      <p>
        Aplica-se a lei brasileira, com foro na comarca de São Roque/SP, ressalvado o direito do
        consumidor de escolher o foro do seu domicílio.
      </p>

      <h2>Contato</h2>
      <p>
        <a href="mailto:fabio.gasparr@gmail.com" className="text-primary underline underline-offset-4">
          fabio.gasparr@gmail.com
        </a>
      </p>
    </PaginaPublica>
  );
}
