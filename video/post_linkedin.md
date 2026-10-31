🌬️ O vento desta cena não é animação. Ele é calculado.

No projeto "Falésia ao vento", juntei arte e mecânica dos fluidos: uma falésia gramada de frente para o mar, em que grama, flores e nuvens se movem com um campo de vento obtido por CFD (dinâmica dos fluidos computacional).

🔧 Como funciona
• Escrevi do zero um solver Lattice Boltzmann (D2Q9) com turbulência LES (Smagorinsky), colisão regularizada e modelo de parede pela lei logarítmica, em Python + Numba
• Ele simula o vento vindo do mar e subindo uma falésia de 30 m: aceleração no topo, separação na borda e a zona de recirculação atrás dela
• O campo de velocidade alimenta uma cena 3D em tempo real no navegador (Three.js), com o mar do meu projeto anterior (ondas de Gerstner) e a bicicleta modelada por script no Blender
• Um modo científico mostra o mesmo escoamento como engenharia: corte vertical, linhas de corrente, vetores, partículas e perfis de vento

✅ Verificação e validação
• Solução analítica de Poiseuille: perfil com 0,08 % de erro e ordem de convergência 1,8
• Convergência de malha em 3 grades (2, 1 e 0,5 m), com índice GCI
• Conservação de massa dentro de 0,07 %
• Aceleração do vento no topo a 6 % do coeficiente orográfico do Eurocode 1 (EN 1991-1-4)

⚠️ Limitações, documentadas no README: a simulação é 2D, e junto ao chão (< 5 m) os resultados, como o tamanho da bolha de recirculação, ainda dependem da malha.

O mais legal foi ver os erros aparecerem nas figuras e corrigir cada um: uma camada-limite grossa demais, um domínio que bloqueava o escoamento e um ruído numérico em xadrez na pressão. É aí que se aprende CFD de verdade.

Código, física e figuras: https://github.com/eniocarlossoilook34-netizen/falesia-ao-vento

#CFD #MecânicaDosFluidos #LatticeBoltzmann #ThreeJS #Python #Blender #Engenharia #Simulação
